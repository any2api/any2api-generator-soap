<?xml version="1.0" encoding="UTF-8"?>
<definitions targetNamespace="<%= implementation.wsdl_ns %>" xmlns:tns="<%= implementation.wsdl_ns %>" xmlns:<%= implementation.wsdl_ns_prefix %>="<%= implementation.wsdl_ns %>" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:MIME="http://schemas.xmlsoap.org/wsdl/mime/" xmlns:DIME="http://schemas.xmlsoap.org/ws/2002/04/dime/wsdl/" xmlns:SOAP="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:WSDL="http://schemas.xmlsoap.org/wsdl/" xmlns="http://schemas.xmlsoap.org/wsdl/" name="<%= implementation.wsdl_name %>">
  
  <% if (implementation.wsdl_doc) { %>
  <documentation>
    <![CDATA[<%= implementation.wsdl_doc %>]]>
  </documentation>
  <% } %>

  <!-- ===== -->
  <!-- Types -->
  <!-- ===== -->

  <types>
    <schema xmlns="http://www.w3.org/2001/XMLSchema" attributeFormDefault="unqualified" elementFormDefault="qualified" targetNamespace="<%= implementation.wsdl_ns %>">
      <!-- <import namespace="http://schemas.xmlsoap.org/soap/encoding/"/> -->

      <complexType name="instance">
        <%= instanceTypeDef %>
      </complexType>

      <complexType name="instanceWritable">
        <%= instanceWritableTypeDef %>
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
          <% }); %> <!-- TODO: consider paramsRequired: minOccurs=1 -->
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

      <% _.forEach(_.map(invokers, function(invoker, name) { invoker.invoker = true; return invoker; }).concat(_.map(executables)), function(item) { %>
      <element name="<%= item.wsdl_name %>Invoke">
        <complexType>
          <sequence>
            <element name="instance" type="<%= implementation.wsdl_ns_prefix %>:instanceWritable"/>
            <element name="parameters" type="<%= implementation.wsdl_ns_prefix %>:<%= item.wsdl_name %>Parameters"/>
            <% if (item.invoker) { %>
            <element name="executable" type="<%= implementation.wsdl_ns_prefix %>:executable"/>
            <% } %>
          </sequence>
        </complexType>
      </element>

      <element name="<%= item.wsdl_name %>InvokeResponse">
        <complexType>
          <sequence>
            <element name="instance" type="<%= implementation.wsdl_ns_prefix %>:instance"/>
            <element name="results" type="<%= implementation.wsdl_ns_prefix %>:<%= item.wsdl_name %>Results"/>
          </sequence>
        </complexType>
      </element>

      <element name="<%= item.wsdl_name %>InvokeAsync">
        <complexType>
          <sequence>
            <element name="instance" type="<%= implementation.wsdl_ns_prefix %>:instanceWritable"/>
            <element name="callback" type="xsd:string"/>
            <element name="parameters" type="<%= implementation.wsdl_ns_prefix %>:<%= item.wsdl_name %>Parameters"/>
            <% if (item.invoker) { %>
            <element name="executable" type="<%= implementation.wsdl_ns_prefix %>:executable"/>
            <% } %>
          </sequence>
        </complexType>
      </element>

      <element name="<%= item.wsdl_name %>InvokeOnFinish">
        <complexType>
          <sequence>
            <element name="instance" type="<%= implementation.wsdl_ns_prefix %>:instance"/>
            <element name="results" type="<%= implementation.wsdl_ns_prefix %>:<%= item.wsdl_name %>Results"/>
          </sequence>
        </complexType>
      </element>
      <% }); %>

      <!-- Empty response -->
      <!-- <element name="myOpResponse"><complexType/></element> -->
    </schema>
  </types>

  <!-- ======== -->
  <!-- Messages -->
  <!-- ======== -->

  <!-- SOAP faults: http://web-gmazza.rhcloud.com/blog/entry/asynchronous-web-service-calls -->
  <!-- <message name="fault"><part name="error" type="xsd:string"/></message> -->

  <% _.forEach(_.map(invokers).concat(_.map(executables)), function(item) { %>
  <message name="<%= item.wsdl_name %>InvokeInput">
    <part name="<%= item.wsdl_name %>InvokeInput" element="<%= implementation.wsdl_ns_prefix %>:<%= item.wsdl_name %>Invoke"/>
  </message>

  <message name="<%= item.wsdl_name %>InvokeOutput">
    <part name="<%= item.wsdl_name %>InvokeOutput" element="<%= implementation.wsdl_ns_prefix %>:<%= item.wsdl_name %>InvokeResponse"/>
  </message>

  <message name="<%= item.wsdl_name %>InvokeAsyncInput">
    <part name="<%= item.wsdl_name %>InvokeAsyncInput" element="<%= implementation.wsdl_ns_prefix %>:<%= item.wsdl_name %>InvokeAsync"/>
  </message>

  <message name="<%= item.wsdl_name %>InvokeOnFinishInput">
    <part name="<%= item.wsdl_name %>InvokeOnFinishInput" element="<%= implementation.wsdl_ns_prefix %>:<%= item.wsdl_name %>InvokeOnFinish"/>
  </message>
  <% }); %>

  <!-- ========== -->
  <!-- Port Types -->
  <!-- ========== -->

  <% _.forEach(_.map(invokers).concat(_.map(executables)), function(item) { %>
  <portType name="<%= item.wsdl_porttype_name %>">
    <operation name="<%= item.wsdl_name %>Invoke">
      <input message="tns:<%= item.wsdl_name %>InvokeInput"/>
      <output message="tns:<%= item.wsdl_name %>InvokeOutput"/>
      <!-- <fault message="tns:fault"/> -->
    </operation>
    <operation name="<%= item.wsdl_name %>InvokeAsync">
      <input message="tns:<%= item.wsdl_name %>InvokeAsyncInput"/>
    </operation>
  </portType>

  <portType name="<%= item.wsdl_cb_porttype_name %>">
    <operation name="<%= item.wsdl_name %>InvokeOnFinish">
      <input message="tns:<%= item.wsdl_name %>InvokeOnFinishInput"/>
    </operation>
  </portType>
  <% }); %>

  <!-- ======== -->
  <!-- Bindings -->
  <!-- ======== -->

  <% _.forEach(_.map(invokers).concat(_.map(executables)), function(item) { %>
  <binding name="<%= item.wsdl_soapbinding_name %>" type="tns:<%= item.wsdl_porttype_name %>">
    <SOAP:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="<%= item.wsdl_name %>Invoke">
      <SOAP:operation style="document" soapAction="<%= implementation.wsdl_ns %>/<%= item.wsdl_name %>Invoke"/>
      <input>
        <!-- <SOAP:body use="encoded" namespace="< % = implementation.wsdl_ns % >" encodingStyle="http://www.w3.org/2003/05/soap-encoding"/> -->
        <SOAP:body use="literal" namespace="<%= implementation.wsdl_ns %>"/>
      </input>
      <output>
        <SOAP:body use="literal" namespace="<%= implementation.wsdl_ns %>"/>
      </output>
      <!-- <fault><SOAP:body use="literal" namespace="< % = implementation.wsdl_ns % >"/></fault> -->
    </operation>
    <operation name="<%= item.wsdl_name %>InvokeAsync">
      <SOAP:operation style="document" soapAction="<%= implementation.wsdl_ns %>/<%= item.wsdl_name %>InvokeAsync"/>
      <input>
        <SOAP:body use="literal" namespace="<%= implementation.wsdl_ns %>"/>
      </input>
    </operation>
  </binding>

  <binding name="<%= item.wsdl_cb_soapbinding_name %>" type="tns:<%= item.wsdl_cb_porttype_name %>">
    <SOAP:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="<%= item.wsdl_name %>InvokeOnFinish">
      <SOAP:operation style="document" soapAction="<%= implementation.wsdl_ns %>/<%= item.wsdl_name %>InvokeOnFinish"/>
      <input>
        <SOAP:body use="literal" namespace="<%= implementation.wsdl_ns %>"/>
      </input>
    </operation>
  </binding>
  <% }); %>

  <!-- ======== -->
  <!-- Services -->
  <!-- ======== -->

  <% _.forEach(_.map(invokers).concat(_.map(executables)), function(item) { %>
  <service name="<%= item.wsdl_service_name %>">
    <port name="<%= item.wsdl_port_name %>" binding="tns:<%= item.wsdl_soapbinding_name %>">
      <SOAP:address location="{{baseAddress}}/<%= item.wsdl_url_path %>"/>
    </port>
  </service>

  <!-- This service endpoint has to be provided by the invoker such as a BPEL workflow -->
  <service name="<%= item.wsdl_cb_service_name %>">
    <port name="<%= item.wsdl_cb_port_name %>" binding="tns:<%= item.wsdl_cb_soapbinding_name %>">
      <SOAP:address location="http://[host]:[port]/<%= item.wsdl_name %>Callback"/>
    </port>
  </service>
  <% }); %>

</definitions>
