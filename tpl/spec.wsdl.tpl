<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns:tns="<%= implementation.wsdl_ns %>" xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:SOAP-ENC="http://www.w3.org/2003/05/soap-encoding" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:<%= implementation.wsdl_ns_prefix %>="<%= implementation.wsdl_ns %>" xmlns:SOAP="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:MIME="http://schemas.xmlsoap.org/wsdl/mime/" xmlns:DIME="http://schemas.xmlsoap.org/ws/2002/04/dime/wsdl/" xmlns:WSDL="http://schemas.xmlsoap.org/wsdl/" xmlns="http://schemas.xmlsoap.org/wsdl/" name="<%= implementation.wsdl_ns %>" targetNamespace="<%= implementation.wsdl_ns %>">

  <types>
    <schema xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:SOAP-ENC="http://www.w3.org/2003/05/soap-encoding" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:<%= implementation.wsdl_ns_prefix %>="<%= implementation.wsdl_ns %>" xmlns="http://www.w3.org/2001/XMLSchema" targetNamespace="<%= implementation.wsdl_ns %>" elementFormDefault="unqualified" attributeFormDefault="unqualified">
      <import namespace="http://www.w3.org/2003/05/soap-encoding"/>

      <complexType name="instance">
        <%= instanceTypeDef %>
      </complexType>

      <complexType name="executable">
        <%= executableTypeDef %>
      </complexType>

      <% _.forEach(_.map(invokers).concat(_.map(executables)), function(item) { %>
      <complexType name="<%= item.wsdl_name %>Parameters">
        <sequence>
          <% _.forEach(item.parameters_schema, function(parameter, name) { %>
          <element name="<%= parameter.wsdl_name %>" type="<%= parameter.wsdl_type_ns_prefix %>:<%= parameter.wsdl_type_name %>" <% if (parameter.wsdl_default) { %>default="<%= parameter.wsdl_default %>"<% } %> minOccurs="0" maxOccurs="1">
            <% if (parameter.wsdl_doc) { %>
            <annotation>
              <documentation>
                <![CDATA[<%= parameter.wsdl_doc %>]]>
              </documentation>
            </annotation>
            <% } %>
          </element>
          <% }); %> <!-- TODO: consider paramsRequired -> minOccurs=1 -->
          <any minOccurs="0" maxOccurs="unbounded" namespace="##targetNamespace"/>
        </sequence>
        <anyAttribute/>
      </complexType>
      <complexType name="<%= item.wsdl_name %>Results">
        <sequence>
          <% _.forEach(item.results_schema, function(result, name) { %>
          <element name="<%= result.wsdl_name %>" type="<%= result.wsdl_type_ns_prefix %>:<%= result.wsdl_type_name %>" minOccurs="0" maxOccurs="1">
            <% if (result.wsdl_doc) { %>
            <annotation>
              <documentation>
                <![CDATA[<%= result.wsdl_doc %>]]>
              </documentation>
            </annotation>
            <% } %>
          </element>
          <% }); %>
          <any minOccurs="0" maxOccurs="unbounded" namespace="##targetNamespace"/>
        </sequence>
        <anyAttribute/>
      </complexType>
      <% _.forEach(item.parameters_schema, function(parameter, name) {
           if (parameter.xml_schema) { %>
      <complexType name="<%= parameter.wsdl_type_name %>">
        <%= parameter.xml_schema %>
      </complexType>
      <%   }
         });
         _.forEach(item.results_schema, function(result, name) {
           if (result.xml_schema) { %>
      <complexType name="<%= result.wsdl_type_name %>">
        <%= result.xml_schema %>
      </complexType>
      <%   }
         }); %>
      <% }); %>
    </schema>
  </types>
  
  <% if (implementation.wsdl_doc) { %>
  <documentation>
    <![CDATA[<%= implementation.wsdl_doc %>]]>
  </documentation>
  <% } %>

  <!-- SOAP faults: http://web-gmazza.rhcloud.com/blog/entry/asynchronous-web-service-calls -->
  <!-- <message name="fault">
    <part name="error" type="xsd:string"/>
  </message> -->

  <% _.forEach(_.map(invokers, function(invoker, name) { invoker.invoker = true; return invoker; }).concat(_.map(executables)), function(item) { %>
  <message name="<%= item.wsdl_name %>InvokeInput">
    <part name="parameters" type="<%= implementation.wsdl_ns_prefix %>:<%= item.wsdl_name %>Parameters"/>

    <% if (item.invoker) { %>
    <part name="executable" type="<%= implementation.wsdl_ns_prefix %>:executable"/>
    <% } %>
  </message>

  <message name="<%= item.wsdl_name %>InvokeOutput">
    <part name="results" type="<%= implementation.wsdl_ns_prefix %>:<%= item.wsdl_name %>Results"/>

    <part name="instance" type="<%= implementation.wsdl_ns_prefix %>:instance"/>
  </message>

  <portType name="<%= item.wsdl_porttype_name %>">
    <operation name="invoke">
      <input message="tns:<%= item.wsdl_name %>InvokeInput"/>
      <output message="tns:<%= item.wsdl_name %>InvokeOutput"/>
      <!-- <fault message="tns:fault"/> -->
    </operation>
  </portType>

  <binding name="<%= item.wsdl_soapbinding_name %>" type="tns:<%= item.wsdl_porttype_name %>">
    <SOAP:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="invoke">
      <SOAP:operation style="rpc"/>
      <input>
        <!-- <SOAP:body use="encoded" namespace="<%= implementation.wsdl_ns %>" encodingStyle="http://www.w3.org/2003/05/soap-encoding"/> -->
        <SOAP:body use="literal"/>
      </input>
      <output>
        <SOAP:body use="literal"/>
      </output>
      <!-- <fault>
        <SOAP:body use="literal"/>
      </fault> -->
    </operation>
  </binding>
  <% }); %>

  <% _.forEach(_.map(invokers).concat(_.map(executables)), function(item) { %>
  <service name="<%= item.wsdl_service_name %>">
    <port name="<%= item.wsdl_port_name %>" binding="tns:<%= item.wsdl_soapbinding_name %>">
      <SOAP:address location="{{baseAddress}}/<%= item.wsdl_url_path %>"/>
    </port>
  </service>
  <% }); %>
</definitions>
